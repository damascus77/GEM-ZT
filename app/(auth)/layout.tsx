import { ThemeToggle } from '@/components/ThemeToggle';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main
      className="min-h-screen flex flex-col items-center justify-center bg-primary p-6 gap-8"
      style={{
        backgroundImage:
          'radial-gradient(80% 60% at 70% 20%, rgba(201,180,250,0.35), transparent 70%)',
      }}
    >
      <ThemeToggle className="absolute top-4 right-4 text-sm text-on-dark-faint hover:text-on-primary" />
      <div className="text-on-primary text-[28px] wght-540 tracking-[-0.63px]">GEM-ZT</div>
      {children}
    </main>
  );
}
