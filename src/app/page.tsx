import CampusApp from "@/components/campus-app";
import LoginGate from "@/components/auth/login-gate";

export default function Home() {
  return (
    <LoginGate>
      <CampusApp />
    </LoginGate>
  );
}
