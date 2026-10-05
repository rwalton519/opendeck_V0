import { GlassPanel } from "./GlassPanel";
import styles from "./PageStub.module.css";

export function PageStub({ title, note }: { title: string; note: string }) {
  return (
    <GlassPanel className={styles.stub}>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.note}>{note}</p>
    </GlassPanel>
  );
}
