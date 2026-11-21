import { ShoppingBag } from 'lucide-react';

export type AppView = 'catalog' | 'orders' | 'account' | 'admin';

interface TopBarProps {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  cartCount: number;
  onOpenCart: () => void;
}

export function TopBar({ activeView, onNavigate, cartCount, onOpenCart }: TopBarProps) {
  const navItems: { id: AppView; label: string }[] = [
    { id: 'catalog', label: 'Catalog' },
    { id: 'orders', label: 'Orders' },
    { id: 'account', label: 'Account' },
    { id: 'admin', label: 'Inventory Admin' },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-8 px-6 lg:px-10">
        <button
          type="button"
          onClick={() => onNavigate('catalog')}
          className="text-lg font-bold tracking-tight text-[#0F172A] whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] rounded-sm"
        >
          ShopStream
        </button>

        <nav aria-label="Primary navigation" className="hidden md:flex items-center gap-7">
          {navItems.map((item) => {
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`relative py-1 text-sm font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] rounded-sm ${
                  isActive
                    ? 'text-[#0F172A] after:absolute after:inset-x-0 after:-bottom-[18px] after:h-[2px] after:bg-[#2563EB]'
                    : 'text-slate-600 hover:text-[#0F172A]'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onOpenCart}
            className="inline-flex items-center gap-2 rounded-lg bg-[#0F172A] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#2563EB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-2 whitespace-nowrap shrink-0 tabular-nums"
          >
            <ShoppingBag className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Cart ({cartCount})</span>
          </button>
        </div>
      </div>

      {/* Mobile navigation strip */}
      <nav
        aria-label="Mobile navigation"
        className="flex md:hidden items-center justify-between border-t border-slate-100 px-4 py-2 overflow-x-auto gap-4"
      >
        {navItems.map((item) => {
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              className={`text-xs font-medium whitespace-nowrap shrink-0 py-1 ${
                isActive ? 'text-[#2563EB] font-semibold' : 'text-slate-600'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
