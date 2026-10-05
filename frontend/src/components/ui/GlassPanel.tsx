import type { HTMLAttributes } from "react";
import styles from "./GlassPanel.module.css";

export function GlassPanel({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={[styles.panel, className].filter(Boolean).join(" ")} {...rest} />;
}
