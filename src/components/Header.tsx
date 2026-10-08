"use client"

import { useEffect, useState } from "react";
import { ChevronDown, ShoppingCart } from "lucide-react";
import { GoLocation } from "react-icons/go";
import AccountList from "@/components/AccountList";
import Cart from "@/components/Cart";
import CategoryNav from "@/components/CategoryNav";
import HeaderSearchControl from "@/components/search/HeaderSearchControl";
import Link from "next/link";
import { useCartStore } from "@/Store/store";
import { usePathname, useRouter } from "next/navigation";
import { SIDEBAR_CATEGORIES } from "@/lib/categories";
import productSearch from "@/lib/productSearch.js";

const { buildSearchUrl } = productSearch;

export type RecentlyViewedItem = {
  SKU: string;
  Name: string;
  image?: string;
  viewedAt: number;
};

const RV_KEY = "recentlyViewed";
const RV_MAX = 12;
const CAT_KEY = "selectedCategoryFilter";

export function getRecentlyViewed(): RecentlyViewedItem[] {
  try {
    return JSON.parse(localStorage.getItem(RV_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function pushRecentlyViewed(item: Omit<RecentlyViewedItem, "viewedAt">) {
  try {
    const existing = getRecentlyViewed().filter((product) => product.SKU !== item.SKU);
    const updated: RecentlyViewedItem[] = [{ ...item, viewedAt: Date.now() }, ...existing].slice(0, RV_MAX);
    localStorage.setItem(RV_KEY, JSON.stringify(updated));
    window.dispatchEvent(new Event("recentlyViewedUpdated"));
  } catch {
    // Ignore localStorage failures.
  }
}

export function storeCategoryFilter(value: string) {
  try {
    if (value === "all") {
      localStorage.removeItem(CAT_KEY);
      return;
    }

    localStorage.setItem(CAT_KEY, value);
  } catch {
    // Ignore localStorage failures.
  }
}

export function UserName() {
  const [value, setValue] = useState<string | null>(null);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      try {
        const raw = localStorage.getItem("UserData");
        if (!raw) return;

        const data = JSON.parse(raw);
        setValue(data?.Dealer_Name ?? data?.city ?? data?.District ?? data?.district ?? null);
      } catch {
        // Ignore invalid storage data.
      }
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, []);

  return <span className="font-bold uppercase">{value}</span>;
}

function useLocationFromStorage() {
  const [city, setCity] = useState<string | null>(null);
  const [pincode, setPincode] = useState<string | null>(null);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      try {
        const raw = localStorage.getItem("UserData");
        if (!raw) return;

        const data = JSON.parse(raw);
        setCity(data?.Dealer_Address ?? data?.city ?? data?.District ?? data?.district ?? null);
        setPincode(data?.Pincode ?? data?.pincode ?? data?.Pin ?? data?.pin ?? null);
      } catch {
        // Ignore invalid storage data.
      }
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, []);

  return { city, pincode };
}

const navItem = "flex flex-col justify-center rounded px-2 py-1 leading-tight border border-transparent hover:border-white/40";

export default function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const cart = useCartStore((state) => state.cart);
  const itemCount = cart.reduce((total, item) => total + item.quantity, 0);
  const { city, pincode } = useLocationFromStorage();

  const [selectedCategory, setSelectedCategory] = useState("all");

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      try {
        const storedCategory = localStorage.getItem(CAT_KEY);
        if (storedCategory && storedCategory !== "all" && SIDEBAR_CATEGORIES[storedCategory]) {
          setSelectedCategory(storedCategory);
        }
      } catch {
        // Ignore invalid storage data.
      }
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, []);

  const logoImage = "/Omsons_Logo.png";

  const locationTop = city || pincode ? "Delivering to" : "Delivering to you";
  const locationBottom = city ? city : pincode ? pincode : "Update location";

  return (
    <header className="relative z-50">
      <div className="flex h-16 w-full items-center gap-3 border-b border-white/10 bg-[#333333] px-4 text-white">
        <Link href="/home" className="shrink-0 px-2">
          <img src={logoImage} alt="Omsons Logo" className="h-12" />
        </Link>

        <div className="flex items-start gap-1 border border-transparent hover:border-white rounded px-2 py-1 cursor-pointer min-w-[120px]">
          <GoLocation className="text-xl mt-3 text-white" />
          <div className="flex flex-col">
            <span className="text-xs text-gray-300">{locationTop}</span>
            <span className="text-sm font-bold truncate max-w-[110px]" title={[city, pincode].filter(Boolean).join(", ")}>
              {locationBottom}
            </span>
            {city && pincode && (
              <span className="text-[10px] text-gray-400 font-normal leading-tight">{pincode}</span>
            )}
          </div>
        </div>

        <HeaderSearchControl
          key={pathname}
          selectedCategory={selectedCategory}
          onCategoryChange={(value) => {
            setSelectedCategory(value);
            storeCategoryFilter(value);
          }}
          onSubmitSearch={(query) => {
            if (!query) return;
            router.push(buildSearchUrl(query));
          }}
          onSelectSuggestion={(suggestion) => {
            pushRecentlyViewed({
              SKU: suggestion.catalogueNumber,
              Name: suggestion.productName,
              image: suggestion.image || suggestion.originalProduct.images?.[0],
            });
            router.push(suggestion.route);
          }}
        />

        <div className="flex items-center gap-1 border border-transparent hover:border-white rounded px-2 py-1 cursor-pointer">
          <span className="text-sm font-bold">EN</span>
        </div>

        <div className={`${navItem} relative group cursor-pointer`}>
          <span className="text-xs font-semibold">
            Hello, <UserName />
          </span>
          <span className="flex items-center gap-1 text-sm font-semibold">
            Account &amp; Lists <ChevronDown className="h-3.5 w-3.5" />
          </span>
          <div className="absolute right-0 top-full z-60 mt-1 hidden w-106 rounded border border-gray-200 bg-white p-3 text-black shadow-lg group-hover:block">
            <AccountList />
          </div>
        </div>

        <Link href="/orders" className={navItem}>
          <span className="text-xs font-semibold">Returns</span>
          <span className="flex items-center gap-1 text-sm font-semibold">
            &amp; Orders <ChevronDown className="h-3.5 w-3.5" />
          </span>
        </Link>

        <div className={`${navItem} relative group`}>
          <Link href="/Pages/Cart" className="relative" aria-label={`Cart, ${itemCount} items`} suppressHydrationWarning>
            <ShoppingCart className="h-8 w-8" strokeWidth={1.75} />
            <span
              className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#1a73e8] px-1 text-[11px] font-bold"
              suppressHydrationWarning
            >
              {itemCount}
            </span>
          </Link>
          <div className="absolute right-0 top-full z-[60] mt-1 hidden w-[440px] overflow-hidden rounded-xl border border-gray-200 bg-white text-black shadow-2xl group-hover:block">
            <Cart />
          </div>
        </div>
      </div>

      <CategoryNav />
    </header>
  );
}
