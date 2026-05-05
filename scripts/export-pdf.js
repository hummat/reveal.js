import process from 'node:process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const __filename = fileURLToPath( import.meta.url );
const __dirname = dirname( __filename );
const defaultRoot = resolve( __dirname, '..' );

const defaults = {
	root: defaultRoot,
	input: 'index.html',
	output: 'deck.pdf',
	host: '127.0.0.1',
	port: 0,
	timeout: 60000,
	width: 1920,
	height: 1080,
	wait: 0
};

const usage = `Usage: node scripts/export-pdf.js [options]

Options:
  --root <path>       Directory to serve. Default: reveal.js root
  --input <path>      HTML entry point within root. Default: index.html
  --output <path>     PDF output path. Default: deck.pdf
  --host <host>       Server host. Default: 127.0.0.1
  --port <port>       Server port. Default: 0 (auto)
  --timeout <ms>      Navigation/render timeout. Default: 60000
  --width <px>        Browser viewport width. Default: 1920
  --height <px>       Browser viewport height. Default: 1080
  --wait <ms>         Extra wait after readiness hook. Default: 0
  --help              Show this help
`;

const parseArgs = ( argv ) => {
	const options = { ...defaults };

	for( let i = 0; i < argv.length; i++ ) {
		const arg = argv[i];
		const value = () => {
			const next = argv[++i];
			if( !next ) throw new Error( `Missing value for ${arg}` );
			return next;
		};

		switch( arg ) {
			case '--root':
				options.root = resolve( value() );
				break;
			case '--input':
				options.input = value();
				break;
			case '--output':
				options.output = resolve( value() );
				break;
			case '--host':
				options.host = value();
				break;
			case '--port':
				options.port = Number.parseInt( value(), 10 );
				break;
			case '--timeout':
				options.timeout = Number.parseInt( value(), 10 );
				break;
			case '--width':
				options.width = Number.parseInt( value(), 10 );
				break;
			case '--height':
				options.height = Number.parseInt( value(), 10 );
				break;
			case '--wait':
				options.wait = Number.parseInt( value(), 10 );
				break;
			case '--help':
				console.log( usage );
				process.exit( 0 );
				break;
			default:
				throw new Error( `Unknown option: ${arg}` );
		}
	}

	return options;
};

const assertInteger = ( name, value, min = 0 ) => {
	if( !Number.isInteger( value ) || value < min ) {
		throw new Error( `${name} must be an integer >= ${min}` );
	}
};

const buildUrl = ( baseUrl, input ) => {
	const url = new URL( input, baseUrl );
	url.searchParams.set( 'print-pdf', '' );
	return url.href;
};

const installPrintDelayHook = async ( page ) => {
	await page.evaluateOnNewDocument( () => {
		if( !window.location.search.includes( 'print-pdf' ) ) return;

		const waitForAnimationFrames = async ( count ) => {
			for( let i = 0; i < count; i++ ) {
				await new Promise( requestAnimationFrame );
			}
		};

		const waitForLegacyIncludes = async () => {
			const startedAt = Date.now();
			while( Date.now() - startedAt < 30000 ) {
				const includes = [ ...document.querySelectorAll( '[data-include]' ) ];
				const loaded = includes.every( include =>
					include.children.length > 0 || include.textContent.trim().length > 0
				);
				if( loaded ) return;
				await new Promise( resolve => setTimeout( resolve, 50 ) );
			}
			throw new Error( 'Timed out waiting for legacy data-include fragments' );
		};

		const nativeAddEventListener = window.addEventListener.bind( window );
		window.addEventListener = ( type, listener, options ) => {
			if( type !== 'load' || typeof listener !== 'function' ) {
				return nativeAddEventListener( type, listener, options );
			}

			return nativeAddEventListener( type, async event => {
				window.__revealPdfLegacyReady = ( async () => {
					await waitForLegacyIncludes();
					await waitForAnimationFrames( 2 );
				} )();

				await window.__revealPdfLegacyReady;
				listener.call( window, event );
			}, options );
		};
	} );
};

const contentTypes = {
	'.css': 'text/css; charset=utf-8',
	'.gif': 'image/gif',
	'.html': 'text/html; charset=utf-8',
	'.ico': 'image/x-icon',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.js': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.ttf': 'font/ttf',
	'.txt': 'text/plain; charset=utf-8',
	'.wasm': 'application/wasm',
	'.webp': 'image/webp',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2'
};

const startServer = ( options ) => new Promise( ( resolvePromise, reject ) => {
	const root = resolve( options.root );
	const server = createServer( ( request, response ) => {
		try {
			const requestUrl = new URL( request.url, `http://${request.headers.host}` );
			const pathname = decodeURIComponent( requestUrl.pathname );
			const relativePath = pathname === '/' ? options.input : pathname.slice( 1 );
			let file = resolve( root, relativePath );
			const legacyFigureFile = relativePath.startsWith( 'assets/figures/' ) ?
				resolve( root, 'assets', relativePath.slice( 'assets/figures/'.length ) ) :
				null;
			const fallbackFile = resolve( defaultRoot, relativePath );

			if( file !== root && !file.startsWith( root + sep ) ) {
				response.writeHead( 403 );
				response.end( 'Forbidden' );
				return;
			}

			if( !existsSync( file ) || !statSync( file ).isFile() ) {
				if( legacyFigureFile && existsSync( legacyFigureFile ) && statSync( legacyFigureFile ).isFile() ) {
					file = legacyFigureFile;
				}
				else if(
					fallbackFile !== defaultRoot &&
					fallbackFile.startsWith( defaultRoot + sep ) &&
					existsSync( fallbackFile ) &&
					statSync( fallbackFile ).isFile()
				) {
					file = fallbackFile;
				}
				else {
					response.writeHead( 404 );
					response.end( 'Not found' );
					return;
				}
			}

			response.writeHead( 200, {
				'Content-Type': contentTypes[ extname( file ).toLowerCase() ] ||
					'application/octet-stream',
				'Connection': 'close'
			} );
			createReadStream( file ).pipe( response );
		}
		catch( error ) {
			response.writeHead( 500 );
			response.end( error.message );
		}
	} );

	server.keepAliveTimeout = 1;
	server.headersTimeout = 2000;
	server.on( 'error', reject );
	server.listen( options.port, options.host, () => {
		const address = server.address();
		resolvePromise( {
			server,
			baseUrl: `http://${address.address}:${address.port}/`
		} );
	} );
} );

const waitForDeck = async ( page, timeout ) => {
	await page.waitForFunction(
		'window.Reveal && Reveal.isReady && Reveal.isReady()',
		{ timeout }
	);

	const hasDeckReadyForPdf = await page.evaluate( () => window.deckReadyForPdf !== undefined );
	if( hasDeckReadyForPdf ) {
		await Promise.race( [
			page.evaluate( () => Promise.resolve( window.deckReadyForPdf ) ),
			new Promise( ( _, reject ) => {
				setTimeout(
					() => reject( new Error( 'Timed out waiting for window.deckReadyForPdf' ) ),
					timeout
				);
			} )
		] );
		return;
	}

	await page.waitForFunction( () => {
		const includes = [ ...document.querySelectorAll( '[data-include]' ) ];
		return includes.every( include =>
			include.children.length > 0 || include.textContent.trim().length > 0
		);
	}, { timeout } );

	await page.waitForSelector( '.pdf-page', { timeout } );

	await page.waitForFunction( () => {
		const plots = [
			...document.querySelectorAll( '.js-plotly-plot, .plotly-graph-div' )
		];
		return plots.every( plot =>
			plot.querySelector( '.main-svg' ) || plot.querySelector( 'canvas' ) || plot._fullLayout
		);
	}, { timeout } );

	await page.evaluate( async () => {
		if( window.Reveal?.getConfig?.().pdfSeparateFragments === false ) {
			document.querySelectorAll( '.fragment' ).forEach( fragment => {
				fragment.classList.add( 'visible' );
				fragment.classList.remove( 'current-fragment' );
			} );
			window.Reveal?.sync?.();
			window.Reveal?.layout?.();
		}

		if( window.Plotly ) {
			document.querySelectorAll( '[data-include]' ).forEach( include => {
				const parent = include.parentElement;
				if( parent && parent.children.length === 1 ) {
					include.style.width = '100%';
				}
			} );

			document.querySelectorAll( '.js-plotly-plot, .plotly-graph-div' ).forEach( plot => {
				const include = plot.closest( '[data-include]' );
				const includeRect = include?.getBoundingClientRect?.();
				const stretchRect = plot.closest( '.r-stretch' )?.getBoundingClientRect?.();

				if( includeRect?.width > 0 ) {
					plot.style.width = `${includeRect.width}px`;
				}

				const height = includeRect?.height > 100 ?
					includeRect.height :
					stretchRect?.height;
				if( height > 100 ) {
					plot.style.height = `${height}px`;
				}

				const rect = plot.getBoundingClientRect();
				if( rect.width > 0 && rect.height > 0 ) {
					Plotly.Plots.resize( plot );
				}
			} );

			await new Promise( resolve => setTimeout( resolve, 500 ) );

			for( const plot of document.querySelectorAll( '.js-plotly-plot, .plotly-graph-div' ) ) {
				const rect = plot.getBoundingClientRect();
				if( rect.width <= 0 || rect.height <= 0 || !window.Plotly.toImage ) continue;

				try {
					const src = await Plotly.toImage( plot, {
						format: 'png',
						width: Math.ceil( rect.width ),
						height: Math.ceil( rect.height ),
						scale: 2
					} );
					const image = document.createElement( 'img' );
					image.src = src;
					image.style.width = `${rect.width}px`;
					image.style.height = `${rect.height}px`;
					image.style.objectFit = 'contain';
					image.style.display = 'block';
					plot.replaceWith( image );
					await image.decode?.();
				}
				catch( error ) {
					console.warn( 'Unable to rasterize Plotly figure for PDF export', error );
				}
			}
		}
		await new Promise( requestAnimationFrame );
		await new Promise( requestAnimationFrame );
	} );
};

const exportPdf = async ( options ) => {
	assertInteger( 'port', options.port );
	assertInteger( 'timeout', options.timeout, 1 );
	assertInteger( 'width', options.width, 1 );
	assertInteger( 'height', options.height, 1 );
	assertInteger( 'wait', options.wait );

	let server;
	let browser;

	try {
		const startedServer = await startServer( options );
		server = startedServer.server;
		const baseUrl = startedServer.baseUrl;
		const url = buildUrl( baseUrl, options.input );

		browser = await puppeteer.launch( {
			headless: 'shell',
			args: [
				'--disable-crash-reporter',
				'--disable-crashpad',
				'--no-sandbox',
				'--disable-setuid-sandbox'
			]
		} );

		const page = await browser.newPage();
		page.setDefaultTimeout( options.timeout );
		await installPrintDelayHook( page );
		await page.setViewport( { width: options.width, height: options.height } );
		await page.goto( url, { waitUntil: 'load', timeout: options.timeout } );
		await waitForDeck( page, options.timeout );

		if( options.wait > 0 ) {
			await new Promise( resolve => setTimeout( resolve, options.wait ) );
		}

		await page.emulateMediaType( 'print' );
		await page.pdf( {
			path: options.output,
			printBackground: true,
			preferCSSPageSize: true,
			margin: {
				top: '0',
				right: '0',
				bottom: '0',
				left: '0'
			}
		} );

		console.log( `Wrote ${options.output}` );
	}
	finally {
		if( browser ) {
			const browserProcess = browser.process();
			browser.disconnect();
			browserProcess?.kill( 'SIGTERM' );
		}
		if( server ) {
			server.closeIdleConnections?.();
			server.closeAllConnections?.();
			server.close();
		}
	}
};

exportPdf( parseArgs( process.argv.slice( 2 ) ) )
	.then( () => process.exit( 0 ) )
	.catch( error => {
		console.error( error.message );
		process.exit( 1 );
	} );
