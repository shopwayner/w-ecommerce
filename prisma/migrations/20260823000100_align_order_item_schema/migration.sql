-- The baseline deliberately mirrors production's current RESTRICT behavior.
-- The canonical schema preserves historical order items by nulling only the
-- optional product reference when a product is deleted.
ALTER TABLE "OrderItem" DROP CONSTRAINT "OrderItem_productId_fkey";

ALTER TABLE "OrderItem"
ADD CONSTRAINT "OrderItem_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
