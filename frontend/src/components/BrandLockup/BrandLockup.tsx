import logo from "@/assets/6b-logo.png";
import styles from "./BrandLockup.module.css";

interface BrandLockupProps {
  subtitle?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export default function BrandLockup({
  subtitle,
  size = "md",
  className = "",
}: BrandLockupProps) {
  return (
    <div className={`${styles.lockup} ${styles[size]} ${className}`}>
      <img src={logo} alt="6B שש בש" className={styles.logo} />
      <div className={styles.copy}>
        <p>6B שש בש</p>
        {subtitle && <span>{subtitle}</span>}
      </div>
    </div>
  );
}
