import React, { useRef, useEffect, useState } from "react";
import "../styles/live-odds.scss";
import { useWebSocketState } from "../ws/WebSocketProvider";

export function LiveOddsPage(): React.JSX.Element | null {
	const { liveOddsState } = useWebSocketState();
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const prevShowRef = useRef(false);
	const [showText, setShowText] = useState(false);
	const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

	useEffect(() => {
		if (!liveOddsState.show) {
			prevShowRef.current = false;
			setShowText(false);
			timersRef.current.forEach(clearTimeout);
			timersRef.current = [];
			return;
		}

		if (!videoRef.current || prevShowRef.current) {
			return;
		}

		try {
			videoRef.current.currentTime = 0;
		} catch (_error) {
			// ignore seek failures
		}

		void videoRef.current.play().catch(() => { });
		prevShowRef.current = true;

		timersRef.current.forEach(clearTimeout);
		timersRef.current = [
			setTimeout(() => setShowText(true), 4000),
			setTimeout(() => setShowText(false), 10000),
		];
	}, [liveOddsState.show]);

	if (!liveOddsState.show) {
		return null;
	}

	return (
		<main className="live-odds">
			<video
				ref={videoRef}
				className="video-layer"
				src="/assets/video.webm"
				muted
				playsInline
				preload="auto"
			/>
			<div className={`odds left${showText ? " show" : ""}`}>{liveOddsState.oddLeft.toFixed(2)}</div>
			<div className={`odds right${showText ? " show" : ""}`}>{liveOddsState.oddRight.toFixed(2)}</div>
		</main>
	);
}
