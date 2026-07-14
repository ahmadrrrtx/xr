import { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { CheckCircle2 } from "lucide-react";

export const metadata: Metadata = { title: "Status" };

const services = [
  { name: "Website", status: "Operational", uptime: "99.99%" },
  { name: "CLI API", status: "Operational", uptime: "99.99%" },
  { name: "Model Gateway", status: "Operational", uptime: "99.97%" },
  { name: "Marketplace", status: "Operational", uptime: "99.99%" },
  { name: "Dashboard", status: "Operational", uptime: "99.98%" },
  { name: "Auth", status: "Operational", uptime: "99.99%" },
];

export default function StatusPage() {
  return (
    <>
      <PageHeader eyebrow="Status" title="All systems normal." subtitle="Real-time status for XR services. Updated every 60 seconds." />
      <section className="pb-24">
        <div className="mx-auto max-w-3xl px-6 space-y-3">
          <div className="card p-6 flex items-center gap-4">
            <div className="h-3 w-3 rounded-full bg-emerald-400 shadow-[0_0_16px_rgba(52,211,153,0.7)] animate-pulse" />
            <div className="flex-1">
              <div className="text-white font-medium">All systems operational</div>
              <div className="text-xs text-zinc-500">Last checked just now</div>
            </div>
            <div className="text-sm text-emerald-300">99.99% uptime (90d)</div>
          </div>
          {services.map((s) => (
            <div key={s.name} className="card px-6 py-4 flex items-center gap-4">
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              <div className="flex-1 text-white">{s.name}</div>
              <div className="text-sm text-emerald-300">{s.status}</div>
              <div className="text-xs text-zinc-500 w-20 text-right tabular-nums">{s.uptime}</div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
