import Image from "next/image";
import Products from "./products/page";

export default function Home() {
  return (
    <div>
      <div className="flex justify-center">
        <Image
          src="/cover-photo.jpg"
          width={700}
          height={500}
          alt="Cover photo"
        />
      </div>
      <div>
        <Products />
      </div>
    </div>
  );
}
