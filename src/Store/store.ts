"use client";

import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CART_STORAGE_KEY } from "@/lib/roleAccess";

export type CartItem = {
  id: string;
  name: string;
  price: number;     // per-pack discounted price
  quantity: number;  // number of packs
  packSize?: number;  // units per pack
  stock?: number;
  isPriority?: boolean;
  image?: string;
};

type CartStore = {
  cart: CartItem[];
  addToCart: (item: Omit<CartItem, "quantity"> & { initialQty?: number }) => void;
  removeFromCart: (id: string) => void;
  incrementQty: (id: string) => void;
  decrementQty: (id: string) => void;
  setQty: (id: string, qty: number) => void;
  togglePriority: (id: string) => void;
  clearCart: () => void;
};

// The cart lives in the TanStack Query cache, mirrored to localStorage so it
// survives reloads. clearAuthStorage() removes it, so it lasts until logout.
const CART_QUERY_KEY = ["cart"] as const;
const EMPTY_CART: CartItem[] = [];

function readCart(): CartItem[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(CART_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const withQty = (cart: CartItem[], id: string, qty: (i: CartItem) => number) =>
  cart
    .map((i) => (i.id === id ? { ...i, quantity: qty(i) } : i))
    .filter((i) => i.quantity > 0);

export function useCartStore<T>(selector: (s: CartStore) => T): T {
  const qc = useQueryClient();
  // Default staleTime (0) re-reads localStorage on mount/focus: picks up other
  // tabs' changes and never outlives a logout that skips a full page load.
  const { data: cart = EMPTY_CART } = useQuery({ queryKey: CART_QUERY_KEY, queryFn: readCart });

  const store = useMemo<CartStore>(() => {
    const update = (fn: (cart: CartItem[]) => CartItem[]) => {
      const next = fn(qc.getQueryData<CartItem[]>(CART_QUERY_KEY) ?? readCart());
      qc.setQueryData(CART_QUERY_KEY, next);
      try { localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(next)); } catch { }
    };

    return {
      cart,

      addToCart: (item) =>
        update((cart) => {
          const addQty = item.initialQty ?? 1;
          if (cart.some((i) => i.id === item.id)) {
            return cart.map((i) =>
              i.id === item.id
                ? {
                    ...i,
                    price: item.price,
                    packSize: item.packSize,
                    image: item.image || i.image,
                    quantity: i.stock ? Math.min(i.quantity + addQty, i.stock) : i.quantity + addQty,
                  }
                : i
            );
          }
          return [
            ...cart,
            {
              id: item.id,
              name: item.name,
              price: item.price,
              packSize: item.packSize,
              stock: item.stock,
              isPriority: item.isPriority ?? false,
              image: item.image,
              quantity: item.stock ? Math.min(addQty, item.stock) : addQty,
            },
          ];
        }),

      incrementQty: (id) =>
        update((cart) => withQty(cart, id, (i) => (i.stock ? Math.min(i.quantity + 1, i.stock) : i.quantity + 1))),

      decrementQty: (id) =>
        update((cart) => withQty(cart, id, (i) => Math.max(0, i.quantity - 1))),

      setQty: (id, qty) =>
        update((cart) => withQty(cart, id, (i) => (i.stock ? Math.min(Math.max(0, qty), i.stock) : Math.max(0, qty)))),

      removeFromCart: (id) => update((cart) => cart.filter((i) => i.id !== id)),

      togglePriority: (id) =>
        update((cart) => cart.map((i) => (i.id === id ? { ...i, isPriority: !i.isPriority } : i))),

      clearCart: () => update(() => []),
    };
  }, [cart, qc]);

  return selector(store);
}
