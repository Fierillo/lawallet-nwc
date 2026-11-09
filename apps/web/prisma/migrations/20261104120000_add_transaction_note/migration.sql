CREATE TABLE "TransactionNote" (
    "userId" TEXT NOT NULL,
    "paymentHash" VARCHAR(64) NOT NULL,
    "note" VARCHAR(280) NOT NULL,

    CONSTRAINT "TransactionNote_pkey" PRIMARY KEY ("userId", "paymentHash")
);

ALTER TABLE "TransactionNote" ADD CONSTRAINT "TransactionNote_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
