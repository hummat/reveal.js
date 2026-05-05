# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Development Commands

### Building
- `npm run build` - Build JavaScript and CSS assets (UMD and ES modules)
- `npm start` - Start development server with live reload
- `gulp serve` - Alternative development server with customizable port/host options

### Testing
- `npm test` - Run ESLint followed by QUnit tests
- `gulp test` - Run the full test suite
- `gulp qunit` - Run QUnit tests only (serves tests on port 8009)
- `gulp eslint` - Run ESLint on JavaScript files

### Individual Test Files
Test files are located in the `/test` directory. Each test file focuses on specific functionality:
- `test.html` - Core functionality tests
- `test-plugins.html` - Plugin system tests
- `test-markdown.html` - Markdown support tests
- `test-auto-animate.html` - Auto-animate feature tests
- `test-scroll.html` - Scroll view tests
- `test-iframes.html` - iframe handling tests
- `test-multiple-instances.html` - Multiple deck instances
- `test-destroy.html` - Cleanup/destruction tests

### Development Workflow
- `gulp serve --root . --port 8000 --host localhost` - Development server with custom settings
- `gulp watch` - File watching is built into serve task for automatic rebuilds

## Architecture Overview

### Core Structure
reveal.js is organized around a modular controller-based architecture:

- **Main Entry Point**: `js/index.js` - Exposes the Reveal API and maintains backwards compatibility
- **Core Deck**: `js/reveal.js` - Main Deck class that orchestrates all controllers
- **Controllers**: `js/controllers/*.js` - Modular feature controllers
- **Configuration**: `js/config.js` - Default configuration options
- **Utilities**: `js/utils/` - Helper utilities and constants

### Controller System
The framework uses a dependency injection pattern where the main Deck class imports and initializes specialized controllers:

- `slidecontent.js` - Slide content parsing and management
- `keyboard.js` - Keyboard navigation and shortcuts
- `controls.js` - UI controls (arrows, progress bar)
- `touch.js` - Touch gesture handling
- `backgrounds.js` - Slide background management
- `fragments.js` - Fragment animations
- `overview.js` - Overview/zoomed-out view
- `scrollview.js` - Continuous scrolling view
- `autoanimate.js` - Auto-animate transitions
- `jumptoslide.js` - Jump to slide functionality
- `notes.js` - Speaker notes system
- `plugins.js` - Plugin management
- `location.js` - URL/history management
- `overlay.js` - Overlay UI components
- `focus.js` - Focus management
- `pointer.js` - Pointer/mouse tracking
- `printview.js` - Printing functionality
- `progress.js` - Progress bar
- `slidenumber.js` - Slide number display

### Plugin Architecture
Plugins are located in `/plugin` directory and follow a consistent structure:
- Each plugin has its own subdirectory with `plugin.js` entry point
- Plugins register themselves via the `Reveal` API
- Built-in plugins include: markdown, math, highlight, search, notes, zoom
- Plugins are built as both UMD and ES modules via the build system

### Build System
- Uses Gulp for task orchestration
- Rollup for bundling with Babel transpilation
- Two JavaScript bundles: UMD (legacy support) and ES modules
- Sass compilation for CSS with autoprefixer
- Terser for minification
- Build outputs to `/dist` directory

### Configuration System
Configuration is layered:
1. Default config in `js/config.js`
2. User overrides passed during initialization
3. Per-slide data attributes
4. URL hash parameters

### Event System
reveal.js uses a custom event system:
- Events are dispatched on slide changes, state changes, etc.
- Listeners can be added via `Reveal.on()` or `Reveal.addEventListener()`
- Events include: 'slidechanged', 'ready', 'resize', 'fragmentshown', etc.

### Backwards Compatibility
The framework maintains backwards compatibility through a compatibility layer:
- Pre-4.0 API is preserved via enqueued API calls
- Singleton pattern alongside multi-instance support
- Legacy initialization method still works

### Browser Support
- UMD bundle targets broad browser compatibility with core-js polyfills
- ES module bundle targets modern browsers (last 2 versions)
- Transpilation via Babel with appropriate presets
- Autoprefixer for CSS compatibility