// `POST /api/c` publishes a new character. The handlers live in the catch-all
// beside this file; this route exists because a catch-all answers for
// `/api/c/<anything>` and the bare collection needs a file of its own.
export { onRequestPost, onRequestOptions } from './[[path]].js';
