import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { AgeScreener } from "./AgeScreener";
import { EmailScreener } from "./EmailScreener";
import {
  UNVERIFIED_PATH,
  hasSeenEmailScreener,
  isAgeVerified,
  rememberAgeVerified,
  rememberEmailScreenerSeen,
} from "./screenerConfig";

type Stage = "age" | "email" | "done";

/**
 * The two pseudo-screeners layered over the landing page ("/"):
 *
 *   age (translucent "Are you 18+?")
 *     Yes -> email (sign-in card)      No -> /unverified (white page, frown)
 *   email
 *     Continue -> /login?email=...     close / Escape / backdrop -> landing page
 *
 * Skipped entirely for signed-in users. A "Yes" is remembered for 30 days
 * (localStorage); the email screener shows at most once per browser session.
 */
export function LandingScreeners() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [stage, setStage] = useState<Stage>(() => {
    if (isAuthenticated) return "done";
    if (!isAgeVerified()) return "age";
    return hasSeenEmailScreener() ? "done" : "email";
  });

  if (stage === "done") return null;

  if (stage === "age") {
    return (
      <AgeScreener
        onYes={() => {
          rememberAgeVerified();
          setStage(hasSeenEmailScreener() ? "done" : "email");
        }}
        onNo={() => navigate(UNVERIFIED_PATH, { replace: true })}
      />
    );
  }

  const finish = () => {
    rememberEmailScreenerSeen();
    setStage("done");
  };

  return (
    <EmailScreener
      onDismiss={finish}
      onSubmitEmail={(email) => {
        rememberEmailScreenerSeen();
        navigate(`/login?email=${encodeURIComponent(email)}`);
      }}
    />
  );
}
