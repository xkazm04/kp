// A "required" marker beside a field label (the input carries aria-required).
// Split out of SetupFirstRoleStep.tsx so both it and SetupFirstRoleWriteFields
// share the one marker instead of duplicating the span.
export function Req() {
  return (
    <span aria-hidden className="text-coral">
      {" *"}
    </span>
  );
}
