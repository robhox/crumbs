-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "wallet" TEXT NOT NULL,
    "protocols" TEXT[],
    "tokens" TEXT[],
    "profitUsd" DOUBLE PRECISION NOT NULL,
    "computeUnits" INTEGER NOT NULL,
    "priorityFee" DOUBLE PRECISION NOT NULL,
    "patternHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_signature_key" ON "Transaction"("signature");
