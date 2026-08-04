"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";

import styles from "./alien-signal-scene.module.css";

const IGNITION_DURATION = 1860;
const DPR_CAP = 1.75;
const STRAND_COUNT = 8;
const STRAND_STEPS = 64;

const FIELD_POINTS = Array.from({ length: 58 }, (_, index) => ({
  x: ((Math.sin(index * 91.17) + 1) / 2) * 0.96 + 0.02,
  y: ((Math.sin(index * 47.71 + 1.9) + 1) / 2) * 0.78 + 0.11,
  size: 0.35 + ((Math.sin(index * 19.37) + 1) / 2) * 0.9,
  drift: Math.sin(index * 8.31),
}));

function easeOutQuint(value: number) {
  return 1 - (1 - value) ** 5;
}

function drawCartography(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  depthX: number,
  depthY: number,
  ignition: number,
) {
  const focusX = width * 0.7 + depthX * 5;
  const focusY = height * 0.515 + depthY * 4;

  context.save();
  context.globalCompositeOperation = "screen";
  context.lineWidth = 0.7;

  for (let ring = 0; ring < 4; ring += 1) {
    context.beginPath();
    context.ellipse(
      focusX,
      focusY,
      width * (0.16 + ring * 0.095),
      height * (0.24 + ring * 0.115),
      depthX * 0.004,
      Math.PI * 1.05,
      Math.PI * 1.95,
    );
    context.strokeStyle = `rgba(233, 228, 217, ${0.025 + ignition * 0.018})`;
    context.stroke();
  }

  for (const point of FIELD_POINTS) {
    const distanceFromGate = Math.abs(point.x - 0.7);
    const signalSide = point.x < 0.7 ? "95, 136, 255" : "255, 101, 74";
    const signalInfluence = Math.max(0, 0.28 - Math.abs(point.y - 0.515));
    const alpha =
      (0.022 + signalInfluence * 0.11) *
      (0.72 + ignition * 0.28) *
      (0.9 - Math.min(0.48, distanceFromGate * 0.28));
    const x = point.x * width + depthX * point.drift * 5;
    const y = point.y * height + depthY * point.drift * 3;

    context.beginPath();
    context.arc(x, y, point.size, 0, Math.PI * 2);
    context.fillStyle = `rgba(${signalInfluence > 0.04 ? signalSide : "233, 228, 217"}, ${alpha})`;
    context.fill();
  }

  context.restore();
}

function drawSignalStrands(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  depthX: number,
  depthY: number,
  ignition: number,
) {
  const gateX = width * 0.7 + depthX * 5;
  const centerY = height * 0.515 + depthY * 6;
  const revealedSteps = Math.max(2, Math.ceil(STRAND_STEPS * ignition));

  context.save();
  context.globalCompositeOperation = "lighter";

  for (let channel = 0; channel < 2; channel += 1) {
    const isInputA = channel === 0;
    const startX = isInputA ? -width * 0.025 : width * 1.025;
    const color = isInputA ? "95, 136, 255" : "255, 101, 74";

    for (let strand = 0; strand < STRAND_COUNT; strand += 1) {
      const lane = strand - (STRAND_COUNT - 1) / 2;
      const phase = strand * 1.13 + channel * 0.62;
      const amplitude = 8 + Math.abs(lane) * 4.2;

      context.beginPath();

      for (let step = 0; step <= revealedSteps; step += 1) {
        const progress = step / STRAND_STEPS;
        const x = startX + (gateX - startX) * progress;
        const taper = Math.sin(Math.PI * progress) * (1 - progress * 0.5);
        const oscillation =
          Math.sin(progress * Math.PI * (5.4 + strand * 0.22) + phase) *
          amplitude *
          taper;
        const laneOffset = lane * 3.2 * (1 - progress);
        const y = centerY + oscillation + laneOffset;

        if (step === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }

      context.strokeStyle = `rgba(${color}, ${0.032 + (STRAND_COUNT - strand) * 0.006})`;
      context.lineWidth = strand % 3 === 0 ? 0.9 : 0.55;
      context.stroke();
    }
  }

  const gateGlow = context.createRadialGradient(
    gateX,
    centerY,
    0,
    gateX,
    centerY,
    Math.max(18, Math.min(width, height) * 0.09),
  );
  gateGlow.addColorStop(0, `rgba(242, 238, 229, ${0.1 * ignition})`);
  gateGlow.addColorStop(0.14, `rgba(233, 228, 217, ${0.04 * ignition})`);
  gateGlow.addColorStop(1, "rgba(233, 228, 217, 0)");
  context.fillStyle = gateGlow;
  context.fillRect(0, 0, width, height);
  context.restore();
}

export function AlienSignalScene() {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { alpha: true });

    if (!root || !canvas || !context) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let width = 0;
    let height = 0;
    let devicePixelRatio = 1;
    let animationFrame = 0;
    let previousTime = 0;
    let ignitionElapsed = reducedMotion.matches ? IGNITION_DURATION : 0;
    let currentX = 0;
    let currentY = 0;
    let targetX = 0;
    let targetY = 0;
    let isVisible = !document.hidden;

    const resizeCanvas = () => {
      const bounds = root.getBoundingClientRect();
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      devicePixelRatio = Math.min(window.devicePixelRatio || 1, DPR_CAP);
      canvas.width = Math.round(width * devicePixelRatio);
      canvas.height = Math.round(height * devicePixelRatio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    };

    const draw = (ignition: number) => {
      context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      context.clearRect(0, 0, width, height);
      drawCartography(context, width, height, currentX, currentY, ignition);
      drawSignalStrands(context, width, height, currentX, currentY, ignition);
    };

    const applyDepth = () => {
      root.style.setProperty("--scene-x", `${(currentX * 7).toFixed(2)}px`);
      root.style.setProperty("--scene-y", `${(currentY * 5).toFixed(2)}px`);
      root.style.setProperty("--field-x", `${(currentX * -3).toFixed(2)}px`);
      root.style.setProperty("--field-y", `${(currentY * -2).toFixed(2)}px`);
    };

    const renderFrame = (time: number) => {
      animationFrame = 0;
      if (!isVisible) return;

      const delta = previousTime === 0 ? 16 : Math.min(48, time - previousTime);
      previousTime = time;

      if (!reducedMotion.matches) {
        ignitionElapsed = Math.min(IGNITION_DURATION, ignitionElapsed + delta);
        const ease = Math.min(1, delta / 72);
        currentX += (targetX - currentX) * ease;
        currentY += (targetY - currentY) * ease;
      } else {
        ignitionElapsed = IGNITION_DURATION;
        currentX = 0;
        currentY = 0;
      }

      const ignition = easeOutQuint(ignitionElapsed / IGNITION_DURATION);
      applyDepth();
      draw(ignition);

      const depthIsMoving =
        Math.abs(targetX - currentX) > 0.002 ||
        Math.abs(targetY - currentY) > 0.002;
      const ignitionIsRunning = ignitionElapsed < IGNITION_DURATION;

      if (ignitionIsRunning || depthIsMoving) {
        animationFrame = window.requestAnimationFrame(renderFrame);
      }
    };

    const requestFrame = () => {
      if (!animationFrame && isVisible) {
        animationFrame = window.requestAnimationFrame(renderFrame);
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (reducedMotion.matches || event.pointerType === "touch") return;
      targetX = Math.max(
        -1,
        Math.min(1, (event.clientX / window.innerWidth) * 2 - 1),
      );
      targetY = Math.max(
        -1,
        Math.min(1, (event.clientY / window.innerHeight) * 2 - 1),
      );
      requestFrame();
    };

    const settleDepth = () => {
      targetX = 0;
      targetY = 0;
      requestFrame();
    };

    const handleVisibility = () => {
      isVisible = !document.hidden;
      previousTime = 0;
      if (!isVisible && animationFrame) {
        window.cancelAnimationFrame(animationFrame);
        animationFrame = 0;
      } else if (isVisible) {
        requestFrame();
      }
    };

    const handleMotionPreference = () => {
      targetX = 0;
      targetY = 0;
      if (reducedMotion.matches) ignitionElapsed = IGNITION_DURATION;
      requestFrame();
    };

    const resizeObserver = new ResizeObserver(() => {
      resizeCanvas();
      requestFrame();
    });

    resizeCanvas();
    resizeObserver.observe(root);
    window.addEventListener("pointermove", handlePointerMove, {
      passive: true,
    });
    document.documentElement.addEventListener("pointerleave", settleDepth, {
      passive: true,
    });
    document.addEventListener("visibilitychange", handleVisibility);
    reducedMotion.addEventListener("change", handleMotionPreference);
    requestFrame();

    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      window.removeEventListener("pointermove", handlePointerMove);
      document.documentElement.removeEventListener("pointerleave", settleDepth);
      document.removeEventListener("visibilitychange", handleVisibility);
      reducedMotion.removeEventListener("change", handleMotionPreference);
    };
  }, []);

  return (
    <div ref={rootRef} className={styles.scene} aria-hidden="true">
      <div className={styles.imageFrame}>
        <Image
          className={styles.image}
          src="/alien/signal-monolith.png"
          alt=""
          fill
          priority
          sizes="100vw"
        />
      </div>
      <canvas ref={canvasRef} className={styles.field} />
      <div className={styles.depthVeil} />
    </div>
  );
}
