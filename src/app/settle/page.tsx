import { redirect } from "next/navigation";

/* The settlement screen lives under the dashboard so it picks up the sidebar
   and role guard; /settle is kept as the short entry point. */
export default function SettleRedirect() {
  redirect("/dashboard/accountant/settle");
}
