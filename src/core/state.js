// Shared mutable application state.
//
// This module holds the singleton `state` object referenced from every
// view and core module. App initialization (in app.js) hydrates the
// fields synchronously at module-load time, before any event handlers
// fire — preserving the original eager-init semantics from when this
// object lived inline in app.js.
//
// apiThrottle and graphView remain in app.js for now and will move to
// their owning modules (core/api.js and views/graph.js) in later phases.

export const state = {};
