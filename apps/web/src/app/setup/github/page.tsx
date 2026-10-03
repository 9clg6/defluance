"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Guided setup lives in Settings, this keeps the documented URL working. */
export default function Page() {
  const router = useRouter();
  useEffect(() => router.replace("/settings/?tab=github"), [router]);
  return null;
}
