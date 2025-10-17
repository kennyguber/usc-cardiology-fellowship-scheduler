import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import VacationPreferences from "./pages/VacationPreferences";
import BlockSchedule from "./pages/BlockSchedule";
import CallSchedule from "./pages/CallSchedule";
import Statistics from "./pages/Statistics";
import Settings from "./pages/Settings";
import AppLayout from "./components/layout/AppLayout";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<AppLayout />}>
            <Route index element={<Index />} />
            <Route path="setup" element={<VacationPreferences />} />
            <Route path="blocks" element={<BlockSchedule />} />
            <Route path="calls" element={<CallSchedule />} />
            <Route path="stats" element={<Statistics />} />
            <Route path="settings" element={<Settings />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
