'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';

export default function CommercialSelector({
  commercials,
  value,
}: {
  commercials: { id: string; name: string; display_name: string | null }[];
  value: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname();

  return (
    <select
      value={value}
      onChange={(e) => {
        const next = new URLSearchParams(params.toString());
        next.set('commercial', e.target.value);
        router.push(`${pathname}?${next.toString()}`);
      }}
      className="rounded-md border bg-white px-3 py-1.5 text-sm"
    >
      {commercials.map((c) => (
        <option key={c.id} value={c.id}>
          {c.display_name || c.name}
        </option>
      ))}
    </select>
  );
}
