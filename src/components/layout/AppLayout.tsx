import { Outlet } from "react-router-dom";
import { AppSidebar } from "@/components/AppSidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { useScrollRestoration } from "@/hooks/use-scroll-restoration";

export default function AppLayout() {
  useScrollRestoration();
  
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="h-12 flex items-center gap-2 border-b px-3">
          <SidebarTrigger className="" />
          <div className="font-display text-sm">Cardiology Scheduler</div>
        </header>
        <div className="flex-1">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
