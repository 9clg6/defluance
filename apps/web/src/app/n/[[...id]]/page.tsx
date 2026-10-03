import { NotePage } from "@/components/NotePage";

// One exported page serves every note: the id is read from the URL in the browser.
export const dynamicParams = false;
export function generateStaticParams() {
  return [{ id: [] as string[] }];
}

export default function Page() {
  return <NotePage />;
}
