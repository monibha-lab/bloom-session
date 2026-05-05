import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center text-coffee/70 font-serif italic">
      Brewing…
    </div>
  );
  if (!user) return <Navigate to="/auth" replace />;
  return <>{children}</>;
}
