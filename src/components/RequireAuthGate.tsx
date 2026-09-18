"use client";

import Link from "next/link";
import useAuth from "@/hooks/useAuth";

type RequireAuthGateProps = {
  children: React.ReactNode;
};

export default function RequireAuthGate({ children }: RequireAuthGateProps) {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="page-content flex min-h-[60vh] items-center justify-center text-center">
        <p className="watch-loading text-sm" role="status">
          <span
            className="watch-spinner"
            aria-hidden="true"
          />
          載入中...
        </p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="page-content flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <p className="text-sm text-watch-text-secondary">請先登入以使用此功能</p>
        <Link
          href="/login"
          className="watch-button"
        >
          登入
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
