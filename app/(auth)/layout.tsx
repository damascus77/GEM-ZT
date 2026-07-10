import { ThemeToggle } from '@/components/ThemeToggle';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center gap-8 bg-primary p-6"
      style={{
        backgroundImage:
          'radial-gradient(80% 60% at 70% 20%, rgba(201,180,250,0.35), transparent 70%)',
      }}
    >
      <ThemeToggle className="absolute right-4 top-4 text-sm text-on-dark-faint hover:text-on-primary" />
      <div className="wght-540 text-[28px] tracking-[-0.63px] text-on-primary">GEM-ZT</div>
      {children}
    </main>
  );
}
