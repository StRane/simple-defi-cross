import React, { useState } from "react";
import { BN } from "@coral-xyz/anchor";

// Hooks
import { useVault, TransactionStatus } from "@/lib/useVault";
import { useTokenSelection, useNFTSelection } from "@/context/SelectionContext";

// UI Components
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Alert, AlertDescription } from "@/components/ui/alert";

// Icons
import {
  Lock,
  TrendingDown,
  Clock,
  Info,
  CheckCircle2,
  Loader2,
} from "lucide-react";

// Lock tier configuration
const LOCK_TIERS = [
  {
    value: 0,
    name: "Unlocked",
    duration: "No lock",
    feeBps: 50,
    color: "bg-gray-500",
    description: "Withdraw anytime, 0.5% fee",
  },
  {
    value: 1,
    name: "Short",
    duration: "30 days",
    feeBps: 30,
    color: "bg-blue-500",
    description: "1 month lock, 0.3% fee",
  },
  {
    value: 2,
    name: "Long",
    duration: "6 months",
    feeBps: 20,
    color: "bg-purple-500",
    description: "6 month lock, 0.2% fee",
  },
  {
    value: 3,
    name: "VeryLong",
    duration: "12 months",
    feeBps: 10,
    color: "bg-green-500",
    description: "1 year lock, 0.1% fee",
  },
];

export const LockPanel: React.FC = () => {
  const [lockAmount, setLockAmount] = useState("");
  const [selectedTier, setSelectedTier] = useState<number>(1);

  // Get from hook
  const { lock, transactionState, hasRequiredSelections, selectedNFTPosition } =
    useVault();

  const { selectedTokenMint } = useTokenSelection();
  const { selectedNFT } = useNFTSelection();

  // Calculate fees
  const amount = parseFloat(lockAmount) || 0;
  const tierConfig =
    LOCK_TIERS.find((t) => t.value === selectedTier) || LOCK_TIERS[1];
  const unlockedTier = LOCK_TIERS[0];

  const feeAmount = (amount * tierConfig.feeBps) / 10000;
  const netDeposit = amount - feeAmount;
  const unlockedFee = (amount * unlockedTier.feeBps) / 10000;
  const feeSavings = unlockedFee - feeAmount;

  // Handle lock
  const handleLock = async () => {
    if (!selectedTokenMint || !selectedNFT || !lockAmount || amount <= 0) {
      return;
    }

    const decimals = 6;
    const amountBN = new BN(amount * Math.pow(10, decimals));

    await lock(amountBN, selectedTokenMint, selectedNFT, selectedTier);
  };

  // Button state
  const getButtonProps = () => {
    const baseDisabled = !hasRequiredSelections || !lockAmount || amount <= 0;

    switch (transactionState.status) {
      case TransactionStatus.BUILDING:
        return {
          disabled: true,
          children: (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Building...
            </>
          ),
        };
      case TransactionStatus.SIGNING:
        return {
          disabled: true,
          children: (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Sign in Wallet...
            </>
          ),
        };
      case TransactionStatus.CONFIRMING:
        return {
          disabled: true,
          children: (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Confirming...
            </>
          ),
        };
      case TransactionStatus.SUCCESS:
        return {
          disabled: baseDisabled,
          children: (
            <>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Lock More
            </>
          ),
        };
      default:
        return {
          disabled: baseDisabled,
          children: (
            <>
              <Lock className="mr-2 h-4 w-4" />
              Lock Tokens
            </>
          ),
        };
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lock className="h-5 w-5" />
          Lock Tokens
        </CardTitle>
        <CardDescription>
          Lock tokens for reduced fees. Longer locks = lower fees.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Amount Input */}
        <div className="space-y-2">
          <Label htmlFor="lock-amount">Lock Amount</Label>
          <Input
            id="lock-amount"
            type="number"
            placeholder="Enter amount to lock"
            value={lockAmount}
            onChange={(e) => setLockAmount(e.target.value)}
            disabled={
              transactionState.status !== TransactionStatus.IDLE ||
              !hasRequiredSelections
            }
          />
        </div>

        {/* Tier Selection */}
        <div className="space-y-3">
          <Label>Lock Duration</Label>
          <RadioGroup
            value={selectedTier.toString()}
            onValueChange={(value) => setSelectedTier(parseInt(value))}
            disabled={transactionState.status !== TransactionStatus.IDLE}
          >
            {LOCK_TIERS.map((tier) => (
              <div
                key={tier.value}
                className={`flex items-start space-x-3 rounded-lg border p-4 cursor-pointer transition-all ${
                  selectedTier === tier.value
                    ? "border-primary bg-accent"
                    : "border-muted hover:border-primary/50"
                }`}
                onClick={() => setSelectedTier(tier.value)}
              >
                <RadioGroupItem
                  value={tier.value.toString()}
                  id={`tier-${tier.value}`}
                />
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <Label
                      htmlFor={`tier-${tier.value}`}
                      className="font-semibold cursor-pointer"
                    >
                      {tier.name}
                    </Label>
                    <Badge
                      variant="outline"
                      className={`${tier.color} text-white border-0`}
                    >
                      {tier.feeBps / 100}% fee
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span>{tier.duration}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {tier.description}
                  </p>
                  {tier.value > 0 && amount > 0 && (
                    <div className="flex items-center gap-1 text-xs text-green-600 mt-1">
                      <TrendingDown className="h-3 w-3" />
                      <span>
                        Save {feeSavings.toFixed(4)} tokens vs unlocked
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </RadioGroup>
        </div>

        {/* Fee Breakdown */}
        {amount > 0 && (
          <div className="rounded-lg border bg-muted/50 p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Info className="h-4 w-4" />
              Fee Breakdown
            </div>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Deposit amount:</span>
                <span className="font-medium">{amount.toFixed(2)} tokens</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  Fee ({tierConfig.feeBps / 100}%):
                </span>
                <span className="font-medium text-orange-600">
                  -{feeAmount.toFixed(4)} tokens
                </span>
              </div>
              <div className="flex justify-between border-t pt-1">
                <span className="text-muted-foreground">Net deposit:</span>
                <span className="font-semibold">
                  {netDeposit.toFixed(4)} tokens
                </span>
              </div>
              {selectedTier > 0 && (
                <div className="flex justify-between text-green-600">
                  <span>Savings vs unlocked:</span>
                  <span className="font-semibold">
                    +{feeSavings.toFixed(4)} tokens
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Existing Position Alert */}
        {selectedNFTPosition && selectedNFTPosition.shareAmount > 0 && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              You have an existing position with{" "}
              {(selectedNFTPosition.shareAmount / 1e6).toFixed(2)} shares.
              Adding more will extend your lock.
            </AlertDescription>
          </Alert>
        )}

        {/* Lock Button */}
        <Button
          onClick={handleLock}
          className="w-full"
          size="lg"
          {...getButtonProps()}
        />

        {/* Requirements Alert */}
        {!hasRequiredSelections && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              Please select both a token and NFT to enable locking.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
};
