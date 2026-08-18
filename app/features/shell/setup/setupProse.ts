// The wizard's ONE prose width.
//
// Body copy in the setup pane runs to 90% of the pane instead of a fixed reading
// measure (`max-w-md`/`max-w-lg`), leaving a tenth of the width as breathing room
// at the right edge. The card is deliberately wide, the blurbs are one or two
// sentences rather than paragraphs, and a 28rem text column inside a 55rem pane
// read as a mistake — the lines broke at points the sentence didn't earn.
//
// It is a constant rather than a class typed at each site so the step bodies, the
// step blurbs and the hand-off summary can't drift apart. Form controls are NOT
// prose: they keep their own narrower widths, because a 45rem-wide email field is
// a worse field, not a wider one.
export const SETUP_PROSE = "max-w-[90%]";
