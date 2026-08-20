/**
 * High-contrast Foresight-branded QR for a live poll.
 *
 * Error correction is High so the Atlas icon can sit in the centre without
 * breaking scans from the back of a room. Always show the short URL under
 * the code — best practice when someone can't get a lock from their camera.
 */

import { useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Check, Copy, Printer } from "lucide-react";
import foresightIconUrl from "../../assets/Foresight_RGB_Icon_Black.png?url";
import { getPollVoteUrl } from "../../utils/pollUrls";
import { Button } from "../ui/button";
import { cn } from "../ui/utils";

interface PollQrCardProps {
  slug: string;
  question: string;
  eventTitle?: string;
  /** Compact card for the projector corner; full for admin / print preview. */
  size?: "poster" | "stage";
  className?: string;
  showActions?: boolean;
}

export function PollQrCard({
  slug,
  question,
  eventTitle,
  size = "poster",
  className,
  showActions = false,
}: PollQrCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const voteUrl = getPollVoteUrl(slug);
  const qrSize = size === "stage" ? 196 : 280;
  const logo = Math.round(qrSize * 0.18);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(voteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard can fail in insecure contexts; URL is visible on the card */
    }
  };

  const handlePrint = () => {
    const card = cardRef.current;
    if (!card) return;
    const qrSvg = card.querySelector("[data-poll-qr] svg")?.outerHTML ?? "";
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    const safeQuestion = escapeHtml(question);
    const safeEvent = eventTitle ? escapeHtml(eventTitle) : "";
    const safeUrl = escapeHtml(voteUrl);

    printWindow.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Foresight Atlas — Vote</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    @page { size: A4 portrait; margin: 14mm; }
    html, body { width: 100%; height: 100%; }
    body {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
      background: white;
      color: #111827;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .poster {
      width: 100%;
      max-width: 460px;
      text-align: center;
      padding: 2.25rem 2rem 2rem;
    }
    .eyebrow {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.28em;
      text-transform: uppercase;
      color: #64748b;
    }
    .question {
      margin-top: 1rem;
      font-family: Georgia, "Times New Roman", serif;
      font-size: 1.65rem;
      line-height: 1.25;
      font-weight: 700;
      color: #0f172a;
    }
    .event {
      margin-top: 0.6rem;
      font-size: 0.95rem;
      color: #475569;
    }
    .hint {
      margin-top: 1.1rem;
      font-size: 0.95rem;
      color: #64748b;
    }
    .qr-wrap {
      margin: 1.75rem auto 1.1rem;
      padding: 1.15rem;
      display: inline-block;
      border: 1px solid #e2e8f0;
      border-radius: 1.25rem;
      background: #fff;
    }
    .qr-wrap svg { display: block; width: 280px; height: 280px; }
    .url {
      font-size: 12px;
      color: #64748b;
      word-break: break-all;
      letter-spacing: 0.01em;
    }
  </style>
</head>
<body>
  <div class="poster">
    <p class="eyebrow">The Foresight Atlas · Poll</p>
    <h1 class="question">${safeQuestion}</h1>
    ${safeEvent ? `<p class="event">${safeEvent}</p>` : ""}
    <p class="hint">Scan to vote anonymously — no app, no sign-in</p>
    <div class="qr-wrap">${qrSvg}</div>
    <p class="url">${safeUrl}</p>
  </div>
</body>
</html>`);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  return (
    <div className={cn("flex flex-col items-center", className)}>
      <div
        ref={cardRef}
        className={cn(
          "w-full rounded-[1.5rem] border border-gray-200 bg-white text-center shadow-sm",
          size === "stage" ? "px-4 py-5" : "px-6 py-7",
        )}
      >
        <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-500">
          The Foresight Atlas
        </p>
        {size === "poster" ? (
          <>
            <h2 className="font-heading mt-3 text-xl font-bold leading-snug text-gray-900 sm:text-2xl">
              {question}
            </h2>
            {eventTitle ? (
              <p className="mt-2 text-sm font-medium text-gray-600">{eventTitle}</p>
            ) : null}
            <p className="mt-3 text-xs text-gray-500">Scan to vote anonymously — no app, no sign-in</p>
          </>
        ) : (
          <p className="mt-2 text-xs font-medium text-gray-600">Scan to vote</p>
        )}
        <div
          data-poll-qr
          className={cn(
            "mx-auto mt-4 w-fit rounded-2xl border border-gray-100 bg-white p-3",
            size === "poster" && "mt-5 p-4",
          )}
        >
          <QRCodeSVG
            value={voteUrl}
            size={qrSize}
            level="H"
            includeMargin={false}
            bgColor="#ffffff"
            fgColor="#0f172a"
            className="mx-auto block"
            imageSettings={{
              src: foresightIconUrl,
              height: logo,
              width: logo,
              excavate: true,
            }}
          />
        </div>
        <p className="mt-3 break-all text-[11px] leading-relaxed text-gray-400">
          {voteUrl.replace(/^https?:\/\//, "")}
        </p>
      </div>
      {showActions ? (
        <div className="mt-4 flex w-full gap-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-[44px] flex-1"
            onClick={() => void handleCopy()}
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? "Copied" : "Copy link"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-[44px] flex-1"
            onClick={handlePrint}
          >
            <Printer className="size-4" />
            Print poster
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
