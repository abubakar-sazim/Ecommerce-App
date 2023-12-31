import { Cart, CartItem, Prisma, PrismaClient } from "@prisma/client";
import { Request, Response } from "express";
import jwt from "jsonwebtoken";

const prisma = new PrismaClient();
const JWT_SECRET = 'bakar31';

export type CartWithProducts = Prisma.CartGetPayload<{
    include: { items: { include: { product: true } } };
}>;

export type CartItemWithProduct = Prisma.CartItemGetPayload<{
    include: { product: true };
}>;

export type ShoppingCart = CartWithProducts & {
    size: number;
    subtotal: number;
};

export async function createCart(req: Request, res: Response) {
    const userToken = req.cookies['userToken'] || '';

    let newCart: { id: any; userId?: number | null; createdAt?: Date; updatedUt?: Date; }

    if (userToken) {
        const decodedToken = jwt.verify(userToken, JWT_SECRET);
        const userId = (decodedToken as { userId: number }).userId;

        newCart = await prisma.cart.create({
            data: { userId: userId },
        });

        const cartData = {
            ...newCart,
            items: [],
            size: 0,
            subtotal: 0,
        };

        return res.status(201).json(cartData);

    } else {
        try {
            newCart = await prisma.cart.create({
                data: {},
            });

            res.cookie("localCartId", newCart.id);

            const cartData = {
                ...newCart,
                items: [],
                size: 0,
                subtotal: 0,
            };

            return res.status(201).json(cartData);
        } catch (error) {
            console.error("Error occurred while creating cart:", error);
            return res.status(500).json({ error: "Internal Server Error" });
        }
    }
}

export async function getCart(req: Request, res: Response) {
    const userToken = req.cookies['userToken'] || '';

    let cart: CartWithProducts | null = null;
    try {
        if (userToken) {
            const decodedToken = jwt.verify(userToken, JWT_SECRET);
            const userId = (decodedToken as { userId: number }).userId;

            cart = await prisma.cart.findFirst({
                where: { userId: userId },
                include: { items: { include: { product: true } } },
            });
        } else {
            const localCartId = parseInt(req.cookies["localCartId"]);

            cart = localCartId
                ? await prisma.cart.findUnique({
                    where: { id: localCartId },
                    include: { items: { include: { product: true } } },
                })
                : null;
        }

        if (!cart) {
            return res.status(404).json({ message: "Cart not found" });
        }

        const cartSize = cart.items.reduce((acc, item) => acc + item.quantity, 0);

        const cartSubtotal = cart.items.reduce(
            (acc, item) => acc + item.quantity * item.product.price.toNumber(),
            0
        );

        const updatedCart: ShoppingCart = {
            ...cart,
            size: cartSize,
            subtotal: cartSubtotal,
        };

        return res.status(200).json(updatedCart);
    } catch (error) {
        console.error("Error occurred while retrieving cart:", error);
        return res
            .status(500)
            .json({ error: "Error occurred while retrieving cart" });
    }
}

export async function incrementCartCount(req: Request, res: Response) {
    const { articleInCart } = req.body;

    if (!articleInCart) {
        return res.status(400).send("Missing articleInCart data");
    }

    try {
        await prisma.cartItem.update({
            where: { id: parseInt(articleInCart.id) },
            data: { quantity: { increment: 1 } },
        });
        return res.status(200).send("Cart count incremented successfully");
    } catch (error) {
        return res.status(500).send("Error incrementing cart count");
    }
}

export async function incrementCartCountFromCart(req: Request, res: Response) {
    const { articleInCart, quantity } = req.body;

    if (!articleInCart) {
        return res.status(400).send("Missing articleInCart data");
    }

    try {
        await prisma.cartItem.update({
            where: { id: parseInt(articleInCart.id) },
            data: { quantity },
        });
        return res.status(200).send("Cart count updated successfully");
    } catch (error) {
        return res.status(500).send("Error incrementing cart count");
    }
}

export async function deleteCartItem(req: Request, res: Response) {
    const { articleInCart } = req.body;

    if (!articleInCart) {
        return res.status(400).send("Missing articleInCart data");
    }

    try {
        await prisma.cartItem.delete({
            where: { id: parseInt(articleInCart.id) },
        });
        return res.status(200).send("Cart item deleted successfully");
    } catch (error) {
        return res.status(500).send("Error deleting cart item");
    }
}

export async function createCartItem(req: Request, res: Response) {
    const { cartData, productId } = req.body;

    if (!cartData) {
        return res.status(400).send("Missing cart data");
    }

    try {
        await prisma.cartItem.create({
            data: {
                cartId: cartData.id,
                productId: parseInt(productId),
                quantity: 1,
            },
        });
        return res.status(200).send("Cart item created successfully");
    } catch (error) {
        console.log(error)
        return res.status(500).send("Error creating cart item");
    }
}

export async function mergeAnonymousCartIntoUserCart(req: Request, res: Response) {
    const { userId } = req.body;
    const localCartId = parseInt(req.cookies["localCartId"]);

    const localCart = localCartId
        ? await prisma.cart.findUnique({
            where: { id: localCartId },
            include: { items: true },
        })
        : null;

    if (!localCart) return;

    const userCart = await prisma.cart.findFirst({
        where: { userId },
        include: { items: true },
    });

    await prisma.$transaction(async (tx) => {
        if (userCart) {
            const mergedCartItems = mergeCartItems(localCart.items, userCart.items);

            await tx.cartItem.deleteMany({
                where: { cartId: userCart.id },
            });

            await tx.cartItem.createMany({
                data: mergedCartItems.map((item) => ({
                    cartId: userCart.id,
                    productId: item.productId,
                    quantity: item.quantity,
                })),
            });
        } else {
            await tx.cart.create({
                data: {
                    userId,
                    items: {
                        createMany: {
                            data: localCart.items.map((item) => ({
                                productId: item.productId,
                                quantity: item.quantity,
                            })),
                        },
                    },
                },
            });
        }

        try {
            await tx.cartItem.deleteMany({
                where: { cartId: localCart.id },
            });

            await tx.cart.delete({
                where: { id: localCart.id },
            });
        } catch (error) {
            console.error(error)
        }

        res.cookie("localCartId", "");
    });
}

function mergeCartItems(...cartItems: CartItem[][]): CartItem[] {
    return cartItems.reduce((acc, items) => {
        items.forEach((item) => {
            const existingItem = acc.find((i) => i.productId === item.productId);
            if (existingItem) {
                existingItem.quantity += item.quantity;
            } else {
                acc.push(item);
            }
        });
        return acc;
    }, [] as CartItem[]);
}


export async function checkout(req: Request, res: Response) {
    try {
        const { userId, cartItems } = req.body;

        const user = await prisma.user.findUnique({
            where: { id: userId },
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const newOrder = await prisma.order.create({
            data: {
                user: { connect: { id: userId } },
                totalAmount: calculateTotal(cartItems),
            },
        });

        for (const cartItem of cartItems) {
            await prisma.orderItem.create({
                data: {
                    order: { connect: { id: newOrder.id } },
                    product: { connect: { product_id: cartItem.productId } },
                    quantity: cartItem.quantity,
                },
            });
        }

        res.status(201).json({ message: 'Order placed successfully' });
    } catch (error) {
        console.error('Error during checkout:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

function calculateTotal(cartItems: any) {
    let total = 0;
    for (const cartItem of cartItems) {
        total += parseInt(cartItem.quantity) * cartItem.product.price;
    }
    return total;
}

export async function deleteCart(req: Request, res: Response) {
    const { cartId } = req.body;

    try {
        await prisma.cartItem.deleteMany({
            where: { cartId: cartId },
        });


        await prisma.cart.delete({
            where: { id: cartId },
        });
        return res.status(200).send("Cart deleted successfully");
    } catch (error) {
        return res.status(500).send(error);
    }
}

// Orders
export async function getOrders(req: Request, res: Response) {
    try {
        const userToken = req.cookies['userToken'] || '';
        const decodedToken = jwt.verify(userToken, JWT_SECRET);
        const userId = (decodedToken as { userId: number }).userId;

        const orders = await prisma.order.findMany({
            where: {
                userId: userId,
            },
            include: {
                orderItems: {
                    include: {
                        product: true,
                    },
                },
            },
            orderBy: {
                createdAt: 'desc',
            },
        });

        res.status(200).json(orders);
    } catch (error) {
        console.error('Error fetching orders:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}


export async function allOrders(req: Request, res: Response) {
    try {
        const allOrders = await prisma.order.findMany({
            include: {
                orderItems: {
                    include: {
                        product: true,
                    },
                },
                user: true,
            },
            orderBy: {
                createdAt: 'desc',
            },
        });
        res.status(200).json(allOrders);
    } catch (error) {
        console.error('Error fetching all orders:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

export async function updateOrderStatus(req: Request, res: Response) {
    const { orderId, newState } = req.body;

    try {
        const updatedOrder = await prisma.order.update({
            where: { id: orderId },
            data: {
                state: newState,
            },
        });

        return res.status(200).json(updatedOrder);
    } catch (error) {
        return res.status(500).send(error);
    }
}
