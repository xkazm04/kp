"use client";

import { forwardRef } from "react";
import { TextInput, type TextInputProps } from "./TextInput";

// datetime-local field in the TextInput family. Locks `type` so Spark Dark,
// invalid, and sizeVariant all apply to the one candidate-facing datetime
// control instead of a third class string. `aria-label` stays the
// caller-supplied name (the propose slots already pass one).

export type DateTimeInputProps = Omit<TextInputProps, "type">;

export const DateTimeInput = forwardRef<HTMLInputElement, DateTimeInputProps>(
  function DateTimeInput(props, ref) {
    return <TextInput ref={ref} {...props} type="datetime-local" />;
  },
);
