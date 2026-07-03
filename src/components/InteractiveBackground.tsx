import { motion, AnimatePresence } from 'motion/react';

interface InteractiveBackgroundProps {
  imageUrl: string;
}

export default function InteractiveBackground({ imageUrl }: InteractiveBackgroundProps) {
  return (
    <div className="absolute inset-0 overflow-hidden rounded-[20px] w-full h-full z-0 pointer-events-none bg-slate-950">
      <AnimatePresence mode="popLayout">
        <motion.div
          key={imageUrl}
          initial={{ opacity: 0, scale: 1.15 }}
          animate={{ opacity: 1, scale: 1.05 }}
          exit={{ opacity: 0, scale: 1 }}
          transition={{ duration: 1.2, ease: [0.25, 1, 0.5, 1] }}
          className="absolute inset-0 w-full h-full"
        >
          <img
            src={imageUrl}
            alt="Dynamic background"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover select-none pointer-events-none scale-110 blur-[14px] filter brightness-90 contrast-125 saturate-[1.45]"
          />
        </motion.div>
      </AnimatePresence>

      <div className="absolute inset-0 bg-gradient-to-br from-white/[0.16] via-transparent to-black/35" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_64%_36%,rgba(255,255,255,0.28),transparent_30%),radial-gradient(circle_at_18%_82%,rgba(120,170,255,0.18),transparent_34%)]" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-black/10 to-black/20" />
    </div>
  );
}
