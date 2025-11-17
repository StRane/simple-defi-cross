// components/shared/AppHeader.tsx
import React from "react";
import { useAppKitAccount } from "@reown/appkit/react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Copy, Lock, Coins, TrendingUp, Clock } from "lucide-react";

import { useVault } from "@/lib/useVault";
import { useTokenSelection, useNFTSelection } from "@/context/SelectionContext";
import {
  getLockTierName,
  getTimeRemaining,
  isLocked,
} from "@/store/vaultStore";

interface AppHeaderProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  programStatus?: {
    connected: boolean;
    label: string;
  };
  currentNetwork?: string | null;
  onCopyToClipboard?: (text: string, label: string) => void;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  title,
  description,
  icon,
  currentNetwork,
  onCopyToClipboard,
}) => {
  const { address } = useAppKitAccount();
  const { selectedTokenMint } = useTokenSelection();
  const { selectedNFT } = useNFTSelection();
  const { selectedNFTPosition } = useVault();

  const handleCopy = (text: string, label: string) => {
    if (onCopyToClipboard) {
      onCopyToClipboard(text, label);
    } else {
      navigator.clipboard.writeText(text);
    }
  };

  const positionLocked = selectedNFTPosition
    ? isLocked(selectedNFTPosition.lockedUntil)
    : false;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              {icon}
              {title}
            </CardTitle>
            <CardDescription className="mt-1">{description}</CardDescription>
          </div>
          {currentNetwork && <Badge variant="outline">{currentNetwork}</Badge>}
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Connection Status */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Wallet */}
          <div>
            <Label className="text-xs text-muted-foreground uppercase tracking-wide mb-2 block">
              Wallet
            </Label>
            <div className="flex items-center justify-self-center gap-2">
              {address ? (
                <>
                  <Badge variant="outline" className="font-mono text-xs">
                    {address.slice(0, 6)}...{address.slice(-4)}
                  </Badge>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => handleCopy(address, "Wallet address")}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </>
              ) : (
                <Badge variant="secondary">Not connected</Badge>
              )}
            </div>
          </div>

          {/* Token */}
          <div>
            <Label className="text-xs text-muted-foreground uppercase tracking-wide mb-2 block">
              Token
            </Label>
            <div className="flex items-center justify-self-center gap-2">
              {selectedTokenMint ? (
                <>
                  <Badge variant="default" className="font-mono text-xs">
                    {selectedTokenMint.toBase58().slice(0, 6)}...
                  </Badge>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() =>
                      handleCopy(selectedTokenMint.toBase58(), "Token mint")
                    }
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </>
              ) : (
                <Badge variant="secondary">None</Badge>
              )}
            </div>
          </div>

          {/* NFT ID */}
          <div>
            <Label className="text-xs text-muted-foreground uppercase tracking-wide mb-2 block">
              Selected ID
            </Label>
            <div className="flex items-center justify-self-center gap-2">
              {selectedNFT ? (
                <>
                  <Badge variant="default" className="font-mono text-xs">
                    {selectedNFT.toBase58().slice(0, 6)}...
                  </Badge>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() =>
                      handleCopy(selectedNFT.toBase58(), "NFT mint")
                    }
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </>
              ) : (
                <Badge variant="secondary">None</Badge>
              )}
            </div>
          </div>
        </div>

        {/* Position Details */}
        {selectedNFTPosition && (
          <div className="border-t pt-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold">Position Details</h3>
              <Badge variant={positionLocked ? "default" : "secondary"}>
                {positionLocked ? "Locked" : "Unlocked"}
              </Badge>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {/* Deposited */}
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Coins className="h-3.5 w-3.5" />
                  <span>Deposited</span>
                </div>
                <p className="flex items-center text-xl font-bold">
                  {(selectedNFTPosition.depositAmount.toNumber()).toFixed(
                    2
                  )}
                </p>
              </div>

              {/* Shares */}
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <TrendingUp className="h-3.5 w-3.5" />
                  <span>Shares</span>
                </div>
                <p className="flex items-center text-xl font-bold">
                  {(selectedNFTPosition.shares.toNumber() / 1e6).toFixed(2)}
                </p>
              </div>

              {/* Time Remaining */}
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  <span>Time Left</span>
                </div>
                <p className="flex items-center text-lg font-semibold font-mono">
                  {getTimeRemaining(selectedNFTPosition.lockedUntil)}
                </p>
              </div>

              {/* Lock Tier */}
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Lock className="h-3.5 w-3.5" />
                  <span>Lock Tier</span>
                </div>
                <div className="pt-1">
                  <Badge
                    variant="outline"
                    className="flex items-center text-xs font-normal"
                  >
                    {getLockTierName(selectedNFTPosition.lockTier)}
                  </Badge>
                </div>
              </div>
            </div>

            {/* Footer Info */}
            <div className="mt-4 pt-4">
              <p className="text-right text-xs text-muted-foreground">
                Deposited on{" "}
                <span className="font-medium text-foreground">
                  {new Date(
                    selectedNFTPosition.depositTime.toNumber() * 1000
                  ).toLocaleDateString()}
                </span>
              </p>
            </div>
          </div>
        )}

        {/* No Position State */}
        {!selectedNFTPosition && selectedNFT && (
          <div className="border-t pt-6">
            <div className="text-center py-6 text-sm text-muted-foreground">
              <p>No position found for this NFT</p>
              <p className="text-xs mt-1">
                Deposit or lock tokens to create a position
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
