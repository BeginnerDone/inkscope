import { useState } from "react";
import { BookOpen } from "lucide-react";

export function BookCover({ title, url }: { title: string; url: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const safeUrl = /^https?:\/\//i.test(url) ? url : "";
  return (
    <span className="book-cover" aria-hidden="true">
      <BookOpen size={20} />
      {safeUrl && failedUrl !== safeUrl && (
        <img
          src={safeUrl}
          alt={title}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(safeUrl)}
        />
      )}
    </span>
  );
}
