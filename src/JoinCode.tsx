import { QRCodeSVG } from "qrcode.react";
export function JoinCode({ game }: { game: string }) {
  const url = `${location.origin}${location.pathname}#/play?game=${game}`;
  return (
    <div className="join-code">
      <div className="qr">
        <QRCodeSVG value={url} size={136} title="QR-код для входа в игру" />
      </div>
      <div>
        <span className="eyebrow">КОД ИГРЫ</span>
        <strong>{game}</strong>
        <a href={url}>Присоединиться ↗</a>
      </div>
    </div>
  );
}
