import { useEffect, useRef } from 'react';

export function useTabScrollRestoration(pathname: string, activeTab: string) {
  const scrollTimeoutRef = useRef<NodeJS.Timeout>();
  const isRestoringRef = useRef(false);
  const previousTabRef = useRef(activeTab);

  useEffect(() => {
    const storageKey = `scroll-${pathname}-${activeTab}`;
    const previousStorageKey = `scroll-${pathname}-${previousTabRef.current}`;
    
    // Save scroll position for previous tab before switching
    if (previousTabRef.current !== activeTab && !isRestoringRef.current) {
      sessionStorage.setItem(previousStorageKey, window.scrollY.toString());
    }
    previousTabRef.current = activeTab;

    // Save scroll position with debouncing
    const handleScroll = () => {
      if (isRestoringRef.current) return;
      
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      
      scrollTimeoutRef.current = setTimeout(() => {
        sessionStorage.setItem(storageKey, window.scrollY.toString());
      }, 100);
    };

    // Restore scroll position with delay and retry logic
    const restoreScroll = async () => {
      const savedPosition = sessionStorage.getItem(storageKey);
      if (!savedPosition) {
        window.scrollTo(0, 0);
        return;
      }

      isRestoringRef.current = true;
      const targetPosition = parseInt(savedPosition, 10);
      let attempts = 0;
      const maxAttempts = 5;

      const tryRestore = () => {
        return new Promise<boolean>((resolve) => {
          requestAnimationFrame(() => {
            window.scrollTo(0, targetPosition);
            
            // Check if we reached the target position
            setTimeout(() => {
              const reached = Math.abs(window.scrollY - targetPosition) < 10;
              resolve(reached);
            }, 50);
          });
        });
      };

      // Initial delay to let content render
      await new Promise(resolve => setTimeout(resolve, 150));

      // Try to restore with retries
      while (attempts < maxAttempts) {
        const success = await tryRestore();
        if (success) break;
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 150));
      }

      // Small delay before re-enabling scroll saving
      setTimeout(() => {
        isRestoringRef.current = false;
      }, 300);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    restoreScroll();

    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      // Save final position on unmount
      if (!isRestoringRef.current) {
        sessionStorage.setItem(storageKey, window.scrollY.toString());
      }
    };
  }, [pathname, activeTab]);
}
