import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, ReactNode } from "react";

export interface InputFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  as?:    "input";
  label:  string;
  error?: string;
  hint?:  string;
}

export interface TextareaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  as:     "textarea";
  label:  string;
  error?: string;
  hint?:  string;
}

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  as:       "select";
  label:    string;
  error?:   string;
  hint?:    string;
  children: ReactNode;
}

export type FormFieldProps = InputFieldProps | TextareaFieldProps | SelectFieldProps;

export function FormField(props: FormFieldProps) {
  const { label, error, hint } = props;

  const body = (() => {
    if (props.as === "select") {
      const { label: _l, error: _e, hint: _h, as: _a, children, ...rest } = props;
      return <select className="field" {...rest}>{children}</select>;
    }
    if (props.as === "textarea") {
      const { label: _l, error: _e, hint: _h, as: _a, ...rest } = props;
      return <textarea className="field" style={{ resize: "vertical" }} {...rest} />;
    }
    const { label: _l, error: _e, hint: _h, as: _a, ...rest } = props as InputFieldProps;
    return <input className="field" {...rest} />;
  })();

  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: "block", fontSize: 10.5, color: "var(--sil)", marginBottom: 4, letterSpacing: ".3px" }}>
        {label}
      </label>
      {body}
      {error && <div style={{ fontSize: 10, color: "var(--R)", marginTop: 3 }}>{error}</div>}
      {hint  && <div style={{ fontSize: 10, color: "var(--sil)", marginTop: 3 }}>{hint}</div>}
    </div>
  );
}
