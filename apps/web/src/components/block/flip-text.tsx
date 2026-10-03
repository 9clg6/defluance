"use client";

import React, { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

interface FlipTextProps {
  children: string;
  className?: string;
}

/** ObsidianUI "Flip Text" (docs version): each character flips on hover. Static for people who prefer reduced motion. */
export function FlipText({ children, className }: FlipTextProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const reduce = useReducedMotion();

  return (
    <span className={cn("inline-flex", className)}>
      {children.split("").map((char, index) => (
        <motion.span
          key={index}
          className="inline-block"
          onMouseEnter={() => setHoveredIndex(index)}
          onMouseLeave={() => setHoveredIndex(null)}
          animate={reduce ? undefined : { rotateX: hoveredIndex === index ? 360 : 0, y: hoveredIndex === index ? -8 : 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        >
          {char === " " ? " " : char}
        </motion.span>
      ))}
    </span>
  );
}

export default FlipText;
