import Link from "next/link";

function DealerComponent() {
  console.log("logout")
  

  const image =
    "/image.png";
  
    return (
      <div className=" bg-white rounded-md  overflow-hidden text-black">
      <div className="w-full h-16 bg-[#e8fdf9] text-white flex items-center px-2 py-2 gap-20 justify-between">
        <div className="flex items-center gap-2 flex-1">
          <img
            src={image}
            alt="profile picture"
            className="w-20 h-10 rounded-full"
          />
          <div className="flex flex-col">
            <span className="text-xs text-gray-800">Admin123</span>
            <span className="text-sm font-bold text-gray-800">Admin</span>
          </div>
        </div>
        <div className="flex flex-row gap-2 px-4 py-1 border-b border-gray-200 justify-evenly">
          <Link href="Dashboard/adminpanel"><span className="w-50 text-left text-sm text-brand-600 hover:text-brand-500 font-sm text-wrap py-1">
            Admin panel
          </span></Link>
          <span onClick={()=>{console.log("signout clicked")}} className="w-full text-left text-sm text-brand-600 hover:text-brand-500 font-medium py-1">
            <Link href="/auth/login">
            Sign out
            </Link>


          </span>
        </div>
      </div>

      <div className=" overflow-y-auto flex justify-between">
        <div className="px-4 py-3 border-b border-gray-200 ">
          <h3 className="text-sm font-bold text-gray-900 mb-2">Your Lists</h3>
          <ul className="space-y-2">
            <li>
              <button className="text-sm text-gray-700 hover:text-brand-500">
                Create a List
              </button>
            </li>
            <li>
              <button className="text-sm text-gray-700 hover:text-brand-500">
                Find a List or Registry
              </button>
            </li>
            <li>
              <button className="text-sm text-gray-700 hover:text-brand-500">
                Your Saved Books
              </button>
            </li>
          </ul>
        </div>

       
      </div>
    </div>
  );

}
export default DealerComponent;
