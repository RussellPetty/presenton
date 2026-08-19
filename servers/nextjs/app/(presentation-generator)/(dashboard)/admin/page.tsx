import { requireAdminSession } from "@/utils/serverAuth";
import AdminPanel from "./AdminPanel";
import { pageTitle } from "@/lib/branding";

export const metadata = {
  title: pageTitle("Admin"),
};

export default async function AdminPage() {
  await requireAdminSession();
  return <AdminPanel />;
}
