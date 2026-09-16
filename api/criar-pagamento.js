import { MercadoPagoConfig, Payment } from "mercadopago";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const mercadoPago = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ erro: "Método não permitido" });
  }

  try {
    const { email } = req.body;

    if (!email || !email.includes("@")) {
      return res.status(400).json({ erro: "Informe um e-mail válido" });
    }

    const { data: produto, error: produtoError } = await supabase
      .from("produtos")
      .select("*")
      .limit(1)
      .single();

    if (produtoError || !produto) {
      return res.status(400).json({ erro: "Produto não encontrado" });
    }

    const { data: link, error: linkError } = await supabase
      .from("links_estoque")
      .select("*")
      .eq("produto_id", produto.id)
      .eq("status", "disponivel")
      .limit(1)
      .single();

    if (linkError || !link) {
      return res.status(400).json({ erro: "Produto sem estoque disponível" });
    }

    const pagamento = new Payment(mercadoPago);

    const resultado = await pagamento.create({
      body: {
        transaction_amount: Number(produto.preco),
        description: produto.nome,
        payment_method_id: "pix",
        payer: {
          email: email
        }
      }
    });

    const { data: pedido, error: pedidoError } = await supabase
      .from("pedidos")
      .insert({
        produto_id: produto.id,
        email: email,
        valor: produto.preco,
        mercado_pago_id: String(resultado.id),
        link_id: link.id
      })
      .select()
      .single();

    if (pedidoError || !pedido) {
      return res.status(500).json({ erro: "Não foi possível criar o pedido" });
    }

    await supabase
      .from("links_estoque")
      .update({
        status: "reservado",
        pedido_id: pedido.id,
        reservado_em: new Date().toISOString()
      })
      .eq("id", link.id)
      .eq("status", "disponivel");

    return res.status(200).json({
      pedido_id: pedido.id,
      qr_code: resultado.point_of_interaction.transaction_data.qr_code,
      qr_code_base64:
        resultado.point_of_interaction.transaction_data.qr_code_base64
    });
  } catch (erro) {
    console.error(erro);
    return res.status(500).json({ erro: "Erro interno no servidor" });
  }
}
