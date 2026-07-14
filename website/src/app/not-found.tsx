import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <section className="pt-44 pb-32">
      <div className="mx-auto max-w-3xl px-6 text-center">
        <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">404</div>
        <h1 className="mt-4 text-5xl md:text-6xl font-semibold tracking-tight text-gradient">
          Page not found.
        </h1>
        <p className="mt-4 text-zinc-400">
          The page you&rsquo;re looking for doesn&rsquo;t exist or has been moved.
        </p>
        <Link href="/" className="btn btn-primary mt-8">
          <ArrowLeft className="h-4 w-4" /> Back home
        </Link>
      </div>
    </section>
  );
}
