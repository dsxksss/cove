import { memo, useMemo, useState } from "react";

const failedListCoverUrls = new Set<string>();

function listCoverThumbnail(src: string): string {
  try {
    const url = new URL(src);
    if (url.hostname.endsWith("music.126.net")) {
      url.searchParams.set("param", "96y96");
      return url.toString();
    }
    if (url.hostname.endsWith("gtimg.cn")) {
      return src.replace(/T002R\d+x\d+M000/i, "T002R90x90M000");
    }
    if (url.hostname.endsWith("kugou.com")) {
      return src.replace(/(stdmusic\/)\d+(\/)/i, "$196$2");
    }
  } catch {
    // Provider occasionally returns a relative/data URL; keep it untouched.
  }
  return src;
}

export const SongThumbnail = memo(function SongThumbnail({
  src,
  loading = "eager",
}: {
  src?: string;
  loading?: "eager" | "lazy";
}) {
  const thumbnail = useMemo(() => (src ? listCoverThumbnail(src) : ""), [src]);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (!thumbnail || failedSrc === thumbnail || failedListCoverUrls.has(thumbnail)) {
    return null;
  }

  return (
    <img
      src={thumbnail}
      alt=""
      decoding="async"
      loading={loading}
      width={40}
      height={40}
      referrerPolicy="no-referrer"
      className="h-full w-full object-cover"
      onError={() => {
        failedListCoverUrls.add(thumbnail);
        if (failedListCoverUrls.size > 256) {
          const oldest = failedListCoverUrls.values().next().value;
          if (oldest) failedListCoverUrls.delete(oldest);
        }
        setFailedSrc(thumbnail);
      }}
    />
  );
});
