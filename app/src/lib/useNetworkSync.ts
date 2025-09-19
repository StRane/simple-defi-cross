import { useEffect } from 'react';
import { useAppKitAccount, useAppKitNetwork } from '@reown/appkit/react';
import { useNetworkStore } from '@/store/networkStore';

/**
 * Centralized network synchronization hook
 * This should only be used ONCE in your app (preferably in the root component)
 * to avoid duplicate network sync calls
 */
export const useNetworkSync = () => {
    const { isConnected } = useAppKitAccount();
    const { caipNetwork } = useAppKitNetwork();
    const { syncNetworkFromAppKit } = useNetworkStore();


    // Centralized network sync - only place in app that calls syncNetworkFromAppKit
    useEffect(() => {
      

        // Sync when connected and we have network info
        if (isConnected && (caipNetwork?.name || caipNetwork?.id)) {
            
            syncNetworkFromAppKit(
                caipNetwork?.name || null,
                caipNetwork?.id?.toString() || null
            );
        }
      
    }, [isConnected, caipNetwork?.name, caipNetwork?.id, syncNetworkFromAppKit]);


};