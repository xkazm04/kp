// Length caps for saved JDs, enforced on both the client (LibraryJdForm) and
// the server (POST /api/jds) so the form and the write trust boundary always
// agree. Bounding length at the write boundary stops unbounded storage growth
// and the downstream render/transfer cost of giant rows.
export const JD_TITLE_MAX_LENGTH = 200;
export const JD_BODY_MAX_LENGTH = 20000;
