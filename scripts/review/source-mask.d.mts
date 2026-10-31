// The masker is plain ESM (scripts/review/ runs on node with no `npm ci`, not
// through tsc); this declaration exists so contract tests under app/ can import
// it under the repo's `noImplicitAny` instead of hand-rolling another copy.
export interface CommentSyntax {
  slashes: boolean;
  hash: boolean;
  dashes: boolean;
}
export interface MaskOptions {
  strings?: boolean;
  comments?: boolean;
  /** Default true (diff-line mode). Pass false for a whole file. */
  line?: boolean;
  syntax?: CommentSyntax;
}
export declare function commentSyntaxFor(filePath: string): CommentSyntax;
export declare function maskOf(src: string, opts?: MaskOptions): Uint8Array;
export declare function codeOnly(src: string, opts?: Omit<MaskOptions, "strings" | "comments">): string;
export declare function withoutComments(src: string, opts?: Omit<MaskOptions, "strings" | "comments">): string;
export declare const codeOnlyLine: (text: string, filePath: string) => string;
export declare const withoutCommentsLine: (text: string, filePath: string) => string;
