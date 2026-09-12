"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { services } from "@/services";
import type { User } from "@/domain/types";
export function useWorkspace(user: User | null) {
  return useQuery({
    queryKey: ["workspace", user?.id, user?.roles],
    queryFn: () => services.dashboard.get(),
    enabled: !!user && !user.mustChangePassword,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: 15000,
    refetchIntervalInBackground: false,
    retry: false,
  });
}
export function useCommand() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => client.invalidateQueries(),
    retry: false,
  });
}
