-- Fotos de cupom: limite de 10 MB e só imagem (JPG, PNG, WEBP). Item 2 da análise do app de compras (07/11/2026).
-- Vale para envios novos; as fotos já guardadas continuam como estão.
update storage.buckets
   set file_size_limit = 10485760,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'cupons';
