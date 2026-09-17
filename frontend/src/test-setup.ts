// jsdom's built-in Blob/File implementation does not implement text()/arrayBuffer()/
// stream() (see https://github.com/jsdom/jsdom/issues/2555). Node's own Blob/File
// (available globally, and exported from node:buffer) are spec-compliant, so use
// those instead of jsdom's versions in the test environment.
import { Blob, File } from 'node:buffer';

globalThis.Blob = Blob as unknown as typeof globalThis.Blob;
globalThis.File = File as unknown as typeof globalThis.File;
